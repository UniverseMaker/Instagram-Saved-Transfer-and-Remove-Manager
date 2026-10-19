// README 스크린샷용 가짜 api — 실제 메인 프로세스 대신 화면에 데모 상태를 주입한다.
const { contextBridge } = require('electron');

const handlers = {};

contextBridge.exposeInMainWorld('api', {
  on: (channel, cb) => { handlers[channel] = cb; },
  invoke: async (channel, arg) => {
    if (channel === 'manager' && handlers.manager) handlers.manager(!!arg);
    return null;
  },
});

contextBridge.exposeInMainWorld('demo', {
  fire: (channel, payload) => { if (handlers[channel]) handlers[channel](payload); },
});
