import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client/dist/sockjs';

const WS_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8080/v1') + '/ws';

let client = null;
let connected = false;
const subscriptions = {};
const pendingSubscriptions = [];

export function connectWebSocket(onConnect) {
  if (client && connected) {
    onConnect?.();
    return;
  }

  client = new Client({
    webSocketFactory: () => new SockJS(WS_URL),
    reconnectDelay: 5000,
    onConnect: () => {
      console.log('WebSocket connected');
      connected = true;
      // Process any pending subscriptions
      while (pendingSubscriptions.length > 0) {
        const { topic, callback } = pendingSubscriptions.shift();
        doSubscribe(topic, callback);
      }
      onConnect?.();
    },
    onDisconnect: () => {
      console.log('WebSocket disconnected');
      connected = false;
    },
    onStompError: (frame) => console.error('STOMP error', frame),
  });

  client.activate();
}

function doSubscribe(topic, callback) {
  if (subscriptions[topic]) {
    subscriptions[topic].unsubscribe();
  }
  subscriptions[topic] = client.subscribe(topic, (message) => {
    try {
      const data = JSON.parse(message.body);
      callback(data);
    } catch (e) {
      console.error('Failed to parse WS message', e);
    }
  });
  console.log('Subscribed to', topic);
}

export function subscribe(topic, callback) {
  if (!client || !connected) {
    console.log('WebSocket not ready, queuing:', topic);
    pendingSubscriptions.push({ topic, callback });
    return;
  }
  doSubscribe(topic, callback);
}

export function disconnect() {
  Object.values(subscriptions).forEach(sub => sub?.unsubscribe());
  Object.keys(subscriptions).forEach(k => delete subscriptions[k]);
  pendingSubscriptions.length = 0;
  connected = false;
  client?.deactivate();
  client = null;
}
