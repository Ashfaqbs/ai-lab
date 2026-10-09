import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 5 },
    { duration: '60s', target: 20 },
    { duration: '30s', target: 0 },
  ],
};

const BASE_URL = __ENV.TARGET_URL || 'http://demo-api.ailab-poc.svc.cluster.local:8080';

export default function () {
  const res = http.post(`${BASE_URL}/api/stress/cpu?seconds=5`);
  check(res, { 'status is 202 or 400': (r) => r.status === 202 || r.status === 400 });
  sleep(1);
}
