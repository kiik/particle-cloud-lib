/** @file DeviceApi.js
 *  @brief Device communication interface
 *
 *  @author Meelik Kiik (kiik.meelik@gmail.com)
 *  @date 16. January 2017
 *  @version 0.1
 */

var fs = require('fs');
var when = require('when');
var util = require('util');
var path = require('path');
var ursa = require('ursa');
var moment = require('moment');

var logger = require('../lib/logger.js');
var utilities = require("../lib/utilities.js");

var sequence = require('when/sequence');
var parallel = require('when/parallel');
var pipeline = require('when/pipeline');

var CoreController = require('./CoreController.js');


var DeviceApi = function(srv) {
  this.req_id_seq = 1;

  this.srv = srv;
  this.getServer = function() { return srv; };

  this.init();
}

DeviceApi.prototype = {

  init: function() {

  },


  getDescription: function (coreID, cb, err) {
    var socket = new CoreController(this.req_id_seq++);

    var that = this;
    var objReady = parallel([
      function () {
        return when.resolve(that.getServer().getCoreAttributes(coreID));
      },
      function () {
        return utilities.alwaysResolve(socket.sendAndListenForDFD(coreID, { cmd: "Describe" }, { cmd: "DescribeReturn" }));
      },
    ]);

    return new Promise(function(fulfill, reject) {
      when(objReady).done(function(results) {
        that.onDescriptionHandler(results, fulfill, reject);
      }, null);
    });
  },

  onDescriptionHandler: function(results, cb, err) {
    try {
      if (!results || (results.length != 2)) {
        logger.error("get_core_attributes results was the wrong length " + JSON.stringify(results));
        return;
      }

      //we're expecting descResult to be an array: [ sender, {} ]
      var doc = results[0],
        descResult = results[1],
        coreState = null;

      if (!doc || !doc.coreID) {
        logger.error("get_core_attributes 404 error: " + JSON.stringify(doc));
        return;
      }

      if (util.isArray(descResult) && (descResult.length > 1)) {
        coreState = descResult[1].state || {};
      }
      if (!coreState) {
        logger.error("get_core_attributes didn't get description: " + JSON.stringify(descResult));
      }

      var device = {
        id: doc.coreID,
        name: doc.name || null,
        last_app: doc.last_flashed,
        connected: !!coreState,
        variables: (coreState) ? coreState.v : null,
        functions: (coreState) ? coreState.f : null,
        cc3000_patch_version: doc.cc3000_driver_version
      };

      if (utilities.check_requires_update(doc, settings.cc3000_driver_version)) {
        device["requires_deep_update"] = true;
      }

      cb(device);
    }
    catch (ex) {
      logger.error("get_core_attributes merge error: " + ex);
      if(err) err({ error: "get_core_attributes error: " + ex });
    }
  },

  getVariable: function (coreID, varName) {
    var socket = new CoreController(this.req_id_seq++);

    var result = socket.sendAndListenForDFD(coreID,
      { cmd: "GetVar", name: varName },
      { cmd: "VarReturn", name: varName },
      5000 // Timeout
    );

    var that = this;
    return new Promise(function(fulfill, reject) {
      when(result)
        .then(function(result) {
          that.onVariableHandler(result, fulfill, reject);
        },
        function() {
          reject({error: "Timed out."});
        })
        .ensure(function() {
          socket.close();
        });
    });
  },

  onVariableHandler: function(result, cb, err) {
    var res = result[1];

    if(res.error) return err(res.error);

    if(!res.result) err(res);
    else {
      res.result._name = res.name;
      cb(res.result);
    }
  },


  flashFirmware: function(coreID, fw) {
    var tmp = when.defer();

    var socket = new CoreController(this.req_id_seq++);

    var failTimer = setTimeout(function () {
      socket.close();
      tmp.reject({error: "Timed out."});
    }, 10000);

    //listen for the first response back from the device service
    socket.listenFor(coreID, { cmd: "Event", name: "Update" },
      function (sender, msg) {
        clearTimeout(failTimer);
        socket.close();

        var response = { id: coreID, status: msg.message };
        if ("Update started" === msg.message) {
          tmp.resolve(response);
        }
        else {
          logger.error("flash_core_dfd rejected ", response);
          tmp.reject(response);
        }

      }, true);

    //send it along to the device service
    socket.send(coreID, { cmd: "UFlash", args: { data: fw, access_token: ':cloud:DeviceManager' } });

    return tmp.promise;
  },


  startDeviceSession(coreID) {

  },

}

module.exports = DeviceApi;
