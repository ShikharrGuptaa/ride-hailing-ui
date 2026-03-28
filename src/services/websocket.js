import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client/dist/sockjs';

const WS_URL = 'http://localhost:8080/v1/ws';

let client = null;
const subscriptions = {};

export function connectWebSocket(onConnect) {
  if (client?.connected) {
    onConnect?.();
    return;
  }

  client = new Client({
    webSocketFactory: () => new SockJS(WS_URL),
    reconnectDelay: 5000,
    onConnect: () => {
      console.log('WebSocket connected');
      onConnect?.();
    },
    onDisconnect: () => console.log('WebSocket disconnected'),
    onStompError: (frame) => console.error('STOMP error', frame),
  });

  client.activate();
}

export function subscribe(topic, callback) {
  if (!client?.connected) {
    console.warn('WebSocket not connected, queuing subscription:', topic);
    setTimeout(() => subscribe(topic, callback), 1000);
    return;
  }

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
}

export function disconnect() {
  Object.values(subscriptions).forEach(sub => sub?.unsubscribe());
  client?.deactivate();
  client = null;
}
