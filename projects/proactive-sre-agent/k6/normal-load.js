import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 5,
  duration: '60s',
};

const BASE_URL = __ENV.TARGET_URL || 'http://demo-api.ailab-poc.svc.cluster.local:8080';

export default function () {
  const payload = JSON.stringify({ customerName: 'k6-load', item: 'widget', quantity: 1 });
  const res = http.post(`${BASE_URL}/api/orders`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, { 'status is 201': (r) => r.status === 201 });
  sleep(1);
}
