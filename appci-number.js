#!/usr/bin/env node

const program = require("commander");
const _ = require("lodash");
const fs = require("fs");
const jws = require("jws");
const axios = require("axios");
const { google } = require('googleapis');


function assertResult(value, ThrowError) {
  if (!value) throw Error(ThrowError);
  return value;
}

const { env } = process;

program
  .command("apple [app_identifier]")
  .option("-V, --app_version [string]", "The version number whose latest build number we want")
  .option("-k, --private_key [string]", "Your private key or use APPLE_PRIVATE_KEY")
  .option("-k, --key_identifier [string]", "Your private key ID from App Store Connect (Ex: 2X9R4HXF34) or use APPLE_KEY_IDENTIFIER")
  .option("-s, --issuer_id [string]", "Issuer ID Your issuer ID from the API Keys page in App Store Connect (Ex: 57246542-96fe-1a63-e053-0824d011072a) or use APPLE_ISSUER_ID")
  .option("-i, --increment", "increment build number")
  .option("--expo [file]", "sets the build number to expo app.json")
  .action(function(appIdentifier, options) {
    const key = assertResult(options.private_key || env.APPLE_PRIVATE_KEY, "private key is required");
    const kid = assertResult(options.key_identifier || env.APPLE_KEY_IDENTIFIER, "key identifier is required");
    const iss = assertResult(options.issuer_id || env.APPLE_ISSUER_ID, "issuer id is required");

    const secret = fs.readFileSync(key);
    const exp = Math.floor(Date.now() / 1000) + 20 * 60;
    const token = jws.sign({
      header: { alg: "ES256", kid, typ: "JWT" },
      payload: JSON.stringify({ iss, exp, aud: "appstoreconnect-v1" }),
      secret,
    });

    const qs = { "filter[app]": appIdentifier };
    if (options.app_version) qs["filter[preReleaseVersion.version]"] = options.app_version;

    const url = `https://api.appstoreconnect.apple.com/v1/builds?${_.map(qs, (v, k) => `${k}=${v}`).join("&")}`
    (async () => {
      try {
        const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
        const buildNumber = _.max(_.map(res.data.data, "attributes.version")) + (options.increment ? 1 : 0);
        console.log(buildNumber);

        if (options.expo) {
          const expo = JSON.parse(fs.readFileSync(options.expo));
          expo.expo.ios.buildNumber = String(buildNumber);
          fs.writeFileSync(expo, JSON.stringify(expo, null, 2));
        }
      } catch (error) {
        console.error(error);
      }
    })();
  });

program
  .command("android [package_name]")
  .option("-k, --key [file]", "Your google play service key or use GOOGLE_PLAY_SERVICE_KEY")
  .option("-i, --increment", "increment build number")
  .option("--expo [file]", "sets the build number to expo app.json")
  .action(function(packageName, options) {
    const key = assertResult(options.key || env.GOOGLE_PLAY_SERVICE_KEY, "google play service key is required");

    const secret = JSON.parse(fs.readFileSync(key));
    const scopes = 'https://www.googleapis.com/auth/androidpublisher';
    const jwt = new google.auth.JWT(secret.client_email, null, secret.private_key, scopes);

    (async () => {
      try {
        await jwt.authorize();
        const androidpublisher = google.androidpublisher({
          version: 'v3',
          auth: jwt,
        });

        const editId = _.get(await androidpublisher.edits.insert({ packageName }), 'data.id');
        const bundles = _.get(await androidpublisher.edits.bundles.list({ editId, packageName }), 'data.bundles');
        const versionCode = _.max(_.map(bundles, 'versionCode')) + (options.increment ? 1 : 0);
        console.log(versionCode);

        if (options.expo) {
          const expo = JSON.parse(fs.readFileSync(options.expo));
          expo.expo.android.versionCode = Number(versionCode);
          fs.writeFileSync(options.expo, JSON.stringify(expo, null, 2));
        }
      } catch (error) {
        console.error(error);
      }
    })();
  });

program.parse(process.argv);