'use strict';

const path = require('path');

const PATHS = {
  src: path.resolve(__dirname, '../src'),
  build: path.resolve(__dirname, '../build'),
  shared: path.resolve(__dirname, '../../ghoti-server/modules/shared'),
};

module.exports = PATHS;
