import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '20s', target: 3 },
    { duration: '60s', target: 10 },
    { duration: '20s', target: 0 },
  ],
};

const BASE_URL = __ENV.TARGET_URL || 'http://demo-api.ailab-poc.svc.cluster.local:8080';

export default function () {
  const holdRes = http.post(`${BASE_URL}/api/stress/db-hold?connections=2&seconds=10`);
  check(holdRes, { 'hold accepted or rejected cleanly': (r) => r.status === 202 || r.status === 400 });

  const crudRes = http.get(`${BASE_URL}/api/orders`);
  check(crudRes, { 'crud still responds': (r) => r.status === 200 });

  sleep(1);
}
