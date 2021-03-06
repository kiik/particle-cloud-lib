/**
*    Copyright (C) 2013-2014 Spark Labs, Inc. All rights reserved. -  https://www.spark.io/
*
*    This program is free software: you can redistribute it and/or modify
*    it under the terms of the GNU Affero General Public License, version 3,
*    as published by the Free Software Foundation.
*
*    This program is distributed in the hope that it will be useful,
*    but WITHOUT ANY WARRANTY; without even the implied warranty of
*    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
*    GNU Affero General Public License for more details.
*
*    You should have received a copy of the GNU Affero General Public License
*    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*
*    You can download the source here: https://github.com/spark/spark-server
*/

var fs = require('fs');
var http = require('http');
var express = require('express');

var morgan = require('morgan'),
    bodyParser = require('body-parser'),
    bb = require('express-busboy'),
    busboy = require('connect-busboy');

var settings = require('./settings.js');
var utilities = require("./lib/utilities.js");
var logger = require('./lib/logger.js');

var OAuthServer = require('node-oauth2-server');
var OAuth2ServerModel = require('./lib/OAuth2ServerModel');
var AccessTokenViews = require('./lib/AccessTokenViews.js');

var DeviceApi = require('./lib/DeviceApi.js');

global._socket_counter = 1;

var oauth = OAuthServer({
  model: new OAuth2ServerModel({  }),
  allow: {
    "post": ['/v1/users'],
    "get": ['/server/health', '/v1/access_tokens'],
    "delete": ['/v1/access_tokens/([0-9a-f]{40})']
  },
  grants: ['password'],
  accessTokenLifetime: 7776000    //90 days
});

var set_cors_headers = function (req, res, next) {
  if ('OPTIONS' === req.method) {
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'X-Requested-With, Content-Type, Accept, Authorization',
      'Access-Control-Max-Age': 300
    });
    return res.send(204);
  }
  else {
    res.set({'Access-Control-Allow-Origin': '*'});
    next();
  }
};

/*
process.on('uncaughtException', function (ex) {
  var details = '';
  try { details = JSON.stringify(ex); }  catch (ex2) { }

  logger.error('Caught exception: ' + ex + details);
  //logger.error(ex.stack);
});
*/

function register_middleware(app, prefix) {
  app.use(prefix, morgan('combined'));

  app.use(prefix, bodyParser.urlencoded({extended:true}));
  app.use(prefix, bodyParser.json());

  app.use(prefix, set_cors_headers);

  app.use(prefix, oauth.authorise());
  app.use('/oauth/token', oauth.grant());
  app.use(prefix, oauth.errorHandler());

  //bb.extend(app);
  app.use(prefix, busboy());
}


module.exports = {
  'register_cloud': function(app) {

    // Add registering endpoint before oauth middleware.
    var UserCreator = require('./lib/UserCreator.js');
    app.post('/v1/users', UserCreator.getMiddleware());

    register_middleware(app, '/v1');

    var api = require('./views/api_v1.js');

    var eventsV1 = require('./views/EventViews001.js');
    var tokenViews = new AccessTokenViews({  });

    eventsV1.loadViews(app);
    api.loadViews(app);
    tokenViews.loadViews(app);

    /** Start device server **/
    var DeviceServer = require("spark-protocol").DeviceServer;
    var server = new DeviceServer({
      coreKeysDir: settings.coreKeysDir,
    });

    server.api = new DeviceApi(server);

    global.server = server;
    server.start();

    app.Particle = {
      getDeviceServer: function() {
        return server;
      }
    }
  }
}
