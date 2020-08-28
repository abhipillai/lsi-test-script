const URL = require('url').URL;
const http = require('http');
const https = require('https');
const repoUrl = new URL('https://repo.sj.lithium.com/config/values?key=community');

// p-queue enables us to make 10 API calls concurrently instead of running everything together
const { default: PQueue } = require('p-queue');
const queue = new PQueue({ concurrency: 10 });

const metrics = [
  'billing_server_requests',
  'billing_application_calls',
  'billing_page_views',
  'visits',
  'pageviews'
];

const makeHttpsRequest = options => {
  return new Promise((resolve, reject) => {
    let url = options.host + (options.path ? options.path : options.pathname);
    https.get(options, response => {
      if (response.statusCode === 200) {
        let data = '';
        response.on('data', (chunk) => data += chunk);
        response.on('end', () => resolve(JSON.parse(data)));
        response.on('error', (err) => reject(`Error: ${err.message}`));
      } else {
        reject(`Http request ${url} returned with the status code of: ${response.statusCode}`);
      }
    });
  });
}

const makeHttpRequest = options => {
  return new Promise((resolve, reject) => {
    let url = options.host + (options.path ? options.path : options.pathname);
    http.get(options, response => {
      if (response.statusCode === 200) {
        let data = '';
        response.on('data', (chunk) => data += chunk);
        response.on('end', () => resolve(JSON.parse(data)));
        response.on('error', (err) => reject(`Error: ${err.message}`));
      } else {
        reject(`Http request ${url} returned with the status code of: ${response.statusCode}`);
      }
    });
  });
}

// Billing Metrics
const getBillingMetrics = () => {

  // Get a list of active communities from repo.sj
  return makeHttpsRequest(repoUrl)
  .then(res => {

    const communities = Object.keys(res);

    let results = [];

    communities
    // .slice(0, 50)          //uncomment this to test fewer community instances
    .forEach(community => {

      let billingMetricsUrl = new URL(`http://internal-ca-fury-dapper-stage-usw2-1736670358.us-west-2.elb.amazonaws.com/dev/v2/${community}/analytics/billing-metrics-usage`);

      let urlPath = billingMetricsUrl.pathname;

      if (billingMetricsUrl.search) {
        urlPath = billingMetricsUrl.pathname + billingMetricsUrl.search;
      }

      let options = {
        method: 'GET',
        host: billingMetricsUrl.hostname,
        path: urlPath
      };

      queue.add(() => makeHttpRequest(options)
        .then(res => results.push({ ...res, community }))
        .catch(err => console.log(`Error: ${err}`)));

    });

    queue.onIdle().then(() => {
      console.log(`Communities with valid results: ${results.length}`);
    });

  });
}

const getMetricsForCommunity = (options, startTime, endTime, metric) => {

  const payload = {
    startTime,
    endTime,
    metric,
    dimensions: [
      'day'
    ]
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, response => {
      let data = '';
      response.on('data', (chunk) => data += chunk);
      response.on('end', () => resolve(JSON.parse(data)));
    });
    req.write(JSON.stringify(payload));
    req.on('error', (err) => {
      reject(`Error: ${err.message}`);
    });
    req.end();
  });

};

const getMetrics = () => {

  return makeHttpsRequest(repoUrl)
  .then(res => {
    const communities = Object.keys(res);

    let results = new Map();

    communities
    // .slice(0, 50)          //uncomment this to test fewer community instances
    .forEach(community => {

      let metricsUrl = new URL(`http://internal-ca-fury-dapper-stage-usw2-1736670358.us-west-2.elb.amazonaws.com/dev/v2/${community}/analytics`);

      let urlPath = metricsUrl.pathname;

      if (metricsUrl.search) {
        urlPath = metricsUrl.pathname + metricsUrl.search;
      }

      let options = {
        host: metricsUrl.hostname,
        path: urlPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      };

      // using the same start and end times as the confluence documentation
      let startTime = 1594512000000;
      let endTime = 1596240000000;

      metrics
        // .slice(0, 1)      // Uncomment to check for only one metric
      .forEach(metric => {
        queue.add(() =>
          getMetricsForCommunity(options, startTime, endTime, metric)
          .then(res => {
            if (!results.has(community)) {
              results.set(community, []);
            }
            results.get(community).push(res);
          }).catch(err => console.log(`Error: ${err}`)));
      });

    });

    queue.onIdle().then(() => {
      console.log(results);
    });

  });


}

getBillingMetrics()
// getMetrics()