// Provider Finder Maps Proxy
//
// Deploy as a Google Apps Script Web App:
// - Execute as: Me
// - Who has access: Anyone
//
// Before deploying, add a Script Property:
// PROVIDER_FINDER_MAPS_SECRET = the same value as APPS_SCRIPT_MAPS_SECRET

const PROVIDER_FINDER_MAPS_SECRET_PROPERTY = "PROVIDER_FINDER_MAPS_SECRET";
// Distance results do not use traffic/departure-time inputs, so a short-lived
// script cache is safe and prevents repeated searches from spending one Maps
// call per provider again. Apps Script CacheService allows up to six hours.
const MAPS_CACHE_TTL_SECONDS = 21600;

function doGet() {
  return jsonOut_({
    ok: true,
    service: "provider-finder-maps-proxy",
  });
}

function doPost(e) {
  const logs = [];

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOut_({ ok: false, error: "no body", logs });
    }

    const body = JSON.parse(e.postData.contents);
    const authError = getAuthError_(body);
    if (authError) {
      return jsonOut_({ ok: false, error: authError, logs });
    }

    if (body.action === "directions") {
      return jsonOut_(handleDirections_(body, logs));
    }

    if (body.action === "geocode") {
      return jsonOut_(handleGeocode_(body, logs));
    }

    return jsonOut_({ ok: false, error: "invalid action", logs });
  } catch (err) {
    return jsonOut_({
      ok: false,
      error: String(err && err.message ? err.message : err),
      logs,
    });
  }
}

function handleDirections_(body, logs) {
  const startedAt = Date.now();
  const origin = cleanString_(body.origin);
  const destinations = Array.isArray(body.destinations) ? body.destinations : [];

  if (!origin) {
    return { ok: false, error: "origin is required", logs };
  }

  const results = destinations.map(function (destination) {
    return getDirectionsOne_(origin, destination, logs);
  });
  // Directions already returns the resolved start location. Reusing it saves
  // one extra geocode call for every Nearby search. Keep a fallback for an
  // empty/legacy cached result so the response contract remains stable.
  let originCoordinates = null;
  for (let index = 0; index < results.length; index += 1) {
    if (results[index] && results[index].startLocation) {
      originCoordinates = results[index].startLocation;
      break;
    }
  }
  if (!originCoordinates) {
    originCoordinates = geocodeOne_(origin, logs);
  }
  logs.push("directions batch total: " + (Date.now() - startedAt) + "ms");

  return {
    ok: true,
    origin: originCoordinates,
    results,
    logs,
  };
}

function handleGeocode_(body, logs) {
  const startedAt = Date.now();
  const addresses = Array.isArray(body.addresses) ? body.addresses : [];
  const results = addresses.map(function (item) {
    const id = cleanString_(item && item.id);
    const address = cleanString_(item && item.address);

    if (!id || !address) {
      return {
        id,
        status: "INVALID_REQUEST",
        error: "missing id or address",
        location: null,
      };
    }

    return {
      id,
      status: "OK",
      error: null,
      location: geocodeOne_(address, logs),
    };
  });

  logs.push("geocode batch total: " + (Date.now() - startedAt) + "ms");

  return {
    ok: true,
    results,
    logs,
  };
}

function getDirectionsOne_(origin, destination, logs) {
  const id = cleanString_(destination && destination.id);
  const address = cleanString_(destination && destination.address);

  if (!id || !address) {
    return {
      id,
      status: "INVALID_REQUEST",
      error: "missing id or address",
      distanceMeters: null,
      endLocation: null,
      polyline: null,
    };
  }

  const cacheInput = origin + "|" + address;
  const cached = readCache_("directions", cacheInput);
  if (cached.hit) {
    logs.push("directions cache hit " + address);
    return Object.assign({ id: id }, cached.value);
  }

  try {
    const directions = Maps.newDirectionFinder()
      .setOrigin(origin)
      .setDestination(address)
      .setMode(Maps.DirectionFinder.Mode.DRIVING)
      .getDirections();

    const route = directions && directions.routes && directions.routes[0];
    const leg = route && route.legs && route.legs[0];
    const distanceMeters = leg && leg.distance && leg.distance.value;
    const endLocation = leg && leg.end_location;
    const polyline =
      route && route.overview_polyline && route.overview_polyline.points;

    if (typeof distanceMeters !== "number") {
      logs.push("directions " + address + ": no usable distance");
      return {
        id,
        status: "ZERO_RESULTS",
        error: "no usable distance",
        distanceMeters: null,
        endLocation: null,
        polyline: null,
      };
    }

    const result = {
      status: "OK",
      error: null,
      distanceMeters: distanceMeters,
      startLocation: normalizeLocation_(leg && leg.start_location),
      endLocation: normalizeLocation_(endLocation),
      polyline: polyline || null,
    };
    writeCache_("directions", cacheInput, result);

    return Object.assign({ id: id }, result);
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    logs.push("directions " + address + ": " + message);

    return {
      id,
      status: "ERROR",
      error: message,
      distanceMeters: null,
      endLocation: null,
      polyline: null,
    };
  }
}

function geocodeOne_(address, logs) {
  const cached = readCache_("geocode", address);
  if (cached.hit) {
    logs.push("geocode cache hit " + address);
    return cached.value;
  }

  try {
    const geocode = Maps.newGeocoder().geocode(address);
    if (
      geocode &&
      geocode.status === "OK" &&
      geocode.results &&
      geocode.results.length > 0
    ) {
      const location = normalizeLocation_(geocode.results[0].geometry.location);
      writeCache_("geocode", address, location);
      return location;
    }

    logs.push(
      "geocode " +
        address +
        ": " +
        (geocode && geocode.status ? geocode.status : "UNKNOWN")
    );
  } catch (err) {
    logs.push(
      "geocode " +
        address +
        ": " +
        String(err && err.message ? err.message : err)
    );
  }

  return null;
}

function readCache_(kind, value) {
  try {
    const raw = CacheService.getScriptCache().get(cacheKey_(kind, value));
    if (raw == null) {
      return { hit: false, value: null };
    }

    const parsed = JSON.parse(raw);
    return {
      hit: true,
      value: parsed && Object.prototype.hasOwnProperty.call(parsed, "value")
        ? parsed.value
        : null,
    };
  } catch (err) {
    return { hit: false, value: null };
  }
}

function writeCache_(kind, keyValue, value) {
  try {
    CacheService.getScriptCache().put(
      cacheKey_(kind, keyValue),
      JSON.stringify({ value: value }),
      MAPS_CACHE_TTL_SECONDS
    );
  } catch (err) {
    // Cache is an optimization only. A cache quota/serialization failure must
    // never turn a valid Maps response into a failed search.
  }
}

function cacheKey_(kind, value) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    kind + "|" + cleanString_(value),
    Utilities.Charset.UTF_8
  );

  return "provider-finder-maps-" + kind + "-" + digest
    .map(function (byte) {
      const normalized = byte < 0 ? byte + 256 : byte;
      return ("0" + normalized.toString(16)).slice(-2);
    })
    .join("");
}

function normalizeLocation_(location) {
  if (
    location &&
    typeof location.lat === "number" &&
    typeof location.lng === "number"
  ) {
    return {
      lat: location.lat,
      lng: location.lng,
    };
  }

  return null;
}

function getAuthError_(body) {
  const expectedSecret = PropertiesService.getScriptProperties().getProperty(
    PROVIDER_FINDER_MAPS_SECRET_PROPERTY
  );

  if (!expectedSecret) {
    return PROVIDER_FINDER_MAPS_SECRET_PROPERTY + " script property is not configured";
  }

  if (!body || cleanString_(body.secret) !== expectedSecret) {
    return "unauthorized";
  }

  return null;
}

function cleanString_(value) {
  return value == null ? "" : String(value).trim();
}

function jsonOut_(obj) {
  // ContentService responses are redirected to a one-time
  // script.googleusercontent.com URL. That redirect is fine for browser GETs
  // but breaks server-side POST clients (the POST becomes GET/405). Return the
  // JSON as HtmlOutput instead so the web app responds directly with 200.
  // Escape HTML-sensitive characters while keeping the body valid JSON.
  const json = JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
  return HtmlService.createHtmlOutput(json);
}
