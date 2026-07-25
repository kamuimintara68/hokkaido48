"use strict";

function buildGoogleMapsUrl(plan) {
  return String((plan && plan["GoogleマップURL"]) ?? "").trim();
}
