'use strict';
const { Micro800Client } = require('../lib/micro800-client');

module.exports = function (RED) {
  function Micro800ConfigNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    node.setMaxListeners(0);
    node.state = 'disconnected';

    // Variable list defined on the "Variables" tab: [{name, tag, dataType}]
    node.vars = (Array.isArray(config.vars) ? config.vars : [])
      .filter((v) => v && v.name && v.tag)
      .map((v) => ({ name: String(v.name).trim(), tag: String(v.tag).trim(), dataType: v.dataType || 'auto', count: Math.max(1, parseInt(v.count, 10) || 1) }));
    node.getVar = (name) => node.vars.find((v) => v.name === name);

    node.client = new Micro800Client({
      host: config.host,
      port: parseInt(config.port, 10) || 44818,
      timeout: parseInt(config.timeout, 10) || 5000
    });

    function setState(s) {
      node.state = s;
      node.emit('state', s);
    }

    node.client.on('connected', () => setState('connected'));
    node.client.on('disconnected', () => setState('disconnected'));

    function tryConnect() {
      if (node.client.connected) return;
      setState('connecting');
      node.client.connect().catch((e) => {
        node.state = 'disconnected';
        node.emit('state', 'disconnected', e.message);
      });
    }

    tryConnect();
    const retryMs = Math.max(1000, parseInt(config.reconnect, 10) || 5000);
    const retry = setInterval(tryConnect, retryMs);

    node.on('close', (done) => {
      clearInterval(retry);
      node.client.close();
      done();
    });
  }
  RED.nodes.registerType('micro800-config', Micro800ConfigNode);
};
