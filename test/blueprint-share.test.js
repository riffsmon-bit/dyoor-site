import assert from "node:assert/strict";
import { test } from "node:test";
import * as share from "../netlify/functions/ascension-blueprint-share.js";
import * as shareImage from "../netlify/functions/ascension-blueprint-share-image.js";

test("blueprint share page emits OG tags and a share image", async () => {
  const event = {
    headers: {
      host: "dyoor.netlify.app",
      "x-forwarded-proto": "https"
    },
    queryStringParameters: {
      saved: "1",
      rank: "31",
      blueprintId: "AB-0031",
      Background: "Goldish.PNG",
      Droid: "Yellow.png",
      Eyes: "Ricky V.png"
    }
  };

  const page = await share.handler(event);

  assert.equal(page.statusCode, 200);
  assert.match(page.body, /property="og:image"/);
  assert.match(page.body, /blueprint-share-image/);
  assert.match(page.body, /AB-0031/);
});

test("blueprint share image emits svg", async () => {
  const event = {
    headers: {
      host: "dyoor.netlify.app",
      "x-forwarded-proto": "https"
    },
    queryStringParameters: {
      saved: "1",
      rank: "31",
      blueprintId: "AB-0031",
      Background: "Goldish.PNG",
      Droid: "Yellow.png",
      Eyes: "Ricky V.png"
    }
  };

  const image = await shareImage.handler(event);

  assert.equal(image.statusCode, 200);
  assert.equal(image.headers["content-type"], "image/png");
  assert.equal(image.isBase64Encoded, true);
  assert.match(image.body, /^[A-Za-z0-9+/=]+$/);
  const buffer = Buffer.from(image.body, "base64");
  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
});
