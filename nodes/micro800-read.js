'use strict';

module.exports = function (RED) {
  function Micro800ReadNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const plc = RED.nodes.getNode(config.plc);

    if (!plc) {
      node.status({ fill: 'red', shape: 'ring', text: 'no PLC configured' });
      return;
    }

    const interval = parseInt(config.interval, 10) || 0;
    let last = null;
    let timer = null;
    let closed = false;
    let lastError = null;

    function showState(s) {
      if (s === 'connected') node.status({ fill: 'green', shape: 'dot', text: 'connected' });
      else if (s === 'connecting') node.status({ fill: 'yellow', shape: 'ring', text: 'connecting' });
      else node.status({ fill: 'red', shape: 'ring', text: 'disconnected' });
    }
    const onState = (s) => showState(s);
    plc.on('state', onState);
    showState(plc.state);

    function fromVar(name) {
      const v = plc.getVar(String(name));
      if (!v) throw new Error(`Unknown variable "${name}" (define it on the PLC config node's Variables tab)`);
      return { key: v.name, tag: v.tag, count: v.count };
    }

    // What to read: msg.variable overrides, otherwise the node's mode.
    function targets(msg) {
      if (msg.variable !== undefined) {
        const names = [].concat(msg.variable);
        return { list: names.map(fromVar), object: names.length > 1, all: false };
      }
      if (config.mode === 'all') {
        if (!plc.vars.length) throw new Error('No variables defined on the PLC config node');
        return { list: plc.vars.map((v) => ({ key: v.name, tag: v.tag, count: v.count })), object: true, all: true };
      }
      if (!config.varName) throw new Error('No variable selected');
      return { list: [fromVar(config.varName)], object: false, all: false };
    }

    async function readAndSend(msg, fromPoll) {
      const t = targets(msg);
      let payload;
      let dataType;
      let topic;

      if (!t.object) {
        const item = t.list[0];
        const r = await plc.client.readTag(item.tag, item.count);
        payload = r.value; dataType = r.type; topic = item.key;
      } else {
        payload = {}; dataType = {};
        for (const item of t.list) {
          const r = await plc.client.readTag(item.tag, item.count);
          payload[item.key] = r.value;
          dataType[item.key] = r.type;
        }
        topic = t.all ? 'all' : t.list.map((i) => i.key).join(',');
      }

      lastError = null;
      if (fromPoll && config.onchange) {
        const key = JSON.stringify(payload);
        if (last === key) return;
        last = key;
      }
      msg.payload = payload;
      msg.topic = topic;
      msg.dataType = dataType;
      node.send(msg);
    }

    function schedule() {
      if (closed || !interval) return;
      timer = setTimeout(poll, interval);
    }
    async function poll() {
      try {
        await readAndSend({}, true);
      } catch (e) {
        if (e.message !== lastError) { node.warn(e.message); lastError = e.message; }
        node.status({ fill: 'red', shape: 'ring', text: e.message.slice(0, 40) });
      }
      schedule();
    }
    if (interval) schedule();

    node.on('input', (msg, send, done) => {
      readAndSend(msg, false).then(() => done && done()).catch((e) => {
        node.status({ fill: 'red', shape: 'ring', text: e.message.slice(0, 40) });
        if (done) done(e); else node.error(e, msg);
      });
    });

    node.on('close', (done) => {
      closed = true;
      if (timer) clearTimeout(timer);
      plc.removeListener('state', onState);
      done();
    });
  }
  RED.nodes.registerType('micro800-read', Micro800ReadNode);
};
