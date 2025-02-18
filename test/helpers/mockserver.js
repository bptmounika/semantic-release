import Docker from "dockerode";
import getStream from "get-stream";
import got from "got";
import pRetry from "p-retry";
import { mockServerClient } from "mockserver-client";

const IMAGE = "mockserver/mockserver:latest";
const MOCK_SERVER_PORT = 1080;
const MOCK_SERVER_HOST = "localhost";
const docker = new Docker();
let container;

/**
 * Download the `mockserver` Docker image, create a new container and start it.
 */
export async function start() {
  await getStream(await docker.pull(IMAGE));

  container = await docker.createContainer({
    Tty: true,
    Image: IMAGE,
    HostConfig: {
      PortBindings: { [`${MOCK_SERVER_PORT}/tcp`]: [{ HostPort: `${MOCK_SERVER_PORT}` }] },
    },
    ExposedPorts: { [`${MOCK_SERVER_PORT}/tcp`]: {} },
  });
  await container.start();

  try {
    // Wait for the mock server to be ready
    await pRetry(() => got.put(`http://${MOCK_SERVER_HOST}:${MOCK_SERVER_PORT}/status`, { cache: false }), {
      retries: 7,
      minTimeout: 1000,
      factor: 2,
    });
  } catch {
    throw new Error(`Couldn't start mock-server after 2 min`);
  }
}

/**
 * Stop and remove the `mockserver` Docker container.
 */
export async function stop() {
  await container.stop();
  await container.remove();
}

/**
 * @type {Object} A `mockserver` client configured to connect to the current instance.
 */
const client = mockServerClient(MOCK_SERVER_HOST, MOCK_SERVER_PORT);
/**
 * @type {string} the url of the `mockserver` instance
 */
export const url = `http://${MOCK_SERVER_HOST}:${MOCK_SERVER_PORT}`;

/**
 * Set up the `mockserver` instance response for a specific request.
 *
 * @param {string} path URI for which to respond.
 * @param {Object} request Request expectation. The http request made on `path` has to match those criteria in order to be valid.
 * @param {Object} request.body The JSON body the expected request must match.
 * @param {Object} request.headers The headers the expected request must match.
 * @param {Object} response The http response to return when receiving a request on `path`.
 * @param {String} [response.method='POST'] The http method for which to respond.
 * @param {number} [response.statusCode=200] The status code to respond.
 * @param {Object} response.body The JSON object to respond in the response body.
 * @return {Object} An object representation the expectation. Pass to the `verify` function to validate the `mockserver` has been called with a `request` matching the expectations.
 */
export async function mock(
  path,
  { body: requestBody, headers: requestHeaders },
  { method = "POST", statusCode = 200, body: responseBody }
) {
  await client.mockAnyResponse({
    httpRequest: { path, method },
    httpResponse: {
      statusCode,
      headers: [{ name: "Content-Type", values: ["application/json; charset=utf-8"] }],
      body: JSON.stringify(responseBody),
    },
    times: { remainingTimes: 1, unlimited: false },
  });

  return {
    method,
    path,
    headers: requestHeaders,
    body: requestBody
      ? { type: "JSON", json: JSON.stringify(requestBody), matchType: "ONLY_MATCHING_FIELDS" }
      : undefined,
  };
}

/**
 * Verify the `mockserver` has been called with a request matching expectations. The `expectation` is created with the `mock` function.
 *
 * @param {Object} expectation The expectation created with `mock` function.
 * @return {Promise} A Promise that resolves if the expectation is met or reject otherwise.
 */
export function verify(expectation) {
  return client.verify(expectation);
}
