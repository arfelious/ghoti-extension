'use strict';

const { merge } = require('webpack-merge');

const common = require('./webpack.common.js');
const PATHS = require('./paths');

// Merge webpack configuration files
const config = (env, argv) =>
  merge(common, {
    entry: {
      popup: PATHS.src + '/popup.js',
      inject: PATHS.src + '/inject.js',
      background: PATHS.src + '/background.js',
      style: PATHS.src + '/style.css',
      settings: PATHS.src + '/settings.js',
    },
    devtool: argv.mode === 'production' ? false : 'source-map',
    resolve: {
      fallback: {
        url: require.resolve('url'),
        "perf_hooks": false,
        "module": false,
      },
    },
  });

module.exports = config;
