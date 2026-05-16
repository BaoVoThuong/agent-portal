// Provider Finder Maps Proxy
//
// Deploy as a Google Apps Script Web App:
// - Execute as: Me
// - Who has access: Anyone
//
// Before deploying, add a Script Property:
// PROVIDER_FINDER_MAPS_SECRET = the same value as APPS_SCRIPT_MAPS_SECRET

const PROVIDER_FINDER_MAPS_SECRET_PROPERTY = "PROVIDER_FINDER_MAPS_SECRET";

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
  const origin = cleanString_(body.origin);
  const destinations = Array.isArray(body.destinations) ? body.destinations : [];

  if (!origin) {
    return { ok: false, error: "origin is required", logs };
  }

  const originCoordinates = geocodeOne_(origin, logs);
  const results = destinations.map(function (destination) {
    return getDirectionsOne_(origin, destination, logs);
  });

  return {
    ok: true,
    origin: originCoordinates,
    results,
    logs,
  };
}

function handleGeocode_(body, logs) {
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

    return {
      id,
      status: "OK",
      error: null,
      distanceMeters,
      endLocation: normalizeLocation_(endLocation),
      polyline: polyline || null,
    };
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
  try {
    const geocode = Maps.newGeocoder().geocode(address);
    if (
      geocode &&
      geocode.status === "OK" &&
      geocode.results &&
      geocode.results.length > 0
    ) {
      return normalizeLocation_(geocode.results[0].geometry.location);
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
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
