'use strict';

module.exports = function (RED) {
  function Micro800WriteNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const plc = RED.nodes.getNode(config.plc);

    if (!plc) {
      node.status({ fill: 'red', shape: 'ring', text: 'no PLC configured' });
      return;
    }

    function showState(s) {
      if (s === 'connected') node.status({ fill: 'green', shape: 'dot', text: 'connected' });
      else if (s === 'connecting') node.status({ fill: 'yellow', shape: 'ring', text: 'connecting' });
      else node.status({ fill: 'red', shape: 'ring', text: 'disconnected' });
    }
    const onState = (s) => showState(s);
    plc.on('state', onState);
    showState(plc.state);

    node.on('input', (msg, send, done) => {
      const name = msg.variable !== undefined ? msg.variable : config.varName;
      if (!name) {
        const e = new Error('No variable selected');
        return done ? done(e) : node.error(e, msg);
      }
      const v = plc.getVar(String(name));
      if (!v) {
        const e = new Error(`Unknown variable "${name}" (define it on the PLC config node's Variables tab)`);
        return done ? done(e) : node.error(e, msg);
      }
      plc.client.writeTag(v.tag, msg.payload, v.dataType)
        .then((r) => {
          msg.topic = v.name;
          msg.dataType = r.type;
          (send || ((m) => node.send(m)))(msg);
          if (done) done();
        })
        .catch((e) => {
          node.status({ fill: 'red', shape: 'ring', text: e.message.slice(0, 40) });
          if (done) done(e); else node.error(e, msg);
        });
    });

    node.on('close', (done) => {
      plc.removeListener('state', onState);
      done();
    });
  }
  RED.nodes.registerType('micro800-write', Micro800WriteNode);
};
