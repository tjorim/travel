import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mapFiles = [
  ["dist/exampleland-2054/public/route-map.geojson", "public"],
  ["dist/exampleland-2054/private/flight-map.geojson", "private"],
  ["dist/exampleland-2054/private/local-route.geojson", "private"]
];

const readMap = async (file) => JSON.parse(await readFile(file, "utf8"));
const isPosition = (value) => Array.isArray(value)
  && value.length === 2
  && value.every(Number.isFinite)
  && value[0] >= -180 && value[0] <= 180
  && value[1] >= -90 && value[1] <= 90;

for (const [file, audience] of mapFiles) {
  test(`${file} follows map-data contract version 1`, async () => {
    const data = await readMap(file);
    assert.equal(data.type, "FeatureCollection");
    assert.equal(data.version, 1);
    assert.equal(data.audience, audience);

    const points = data.features.filter((feature) => feature.geometry?.type === "Point");
    const routes = data.features.filter((feature) => feature.geometry?.type === "LineString");
    const pointIds = new Set(points.map((feature) => feature.properties?.id));
    assert.ok(points.length >= 2);
    assert.ok(routes.length >= 1);
    assert.ok(points.every((feature) => typeof feature.properties?.id === "string"
      && typeof feature.properties?.label === "string"
      && isPosition(feature.geometry.coordinates)));
    assert.ok(routes.every((feature) => pointIds.has(feature.properties?.from)
      && pointIds.has(feature.properties?.to)
      && ["flight", "rail", "road", "mountain"].includes(feature.properties?.transport)
      && feature.geometry.coordinates.length >= 2
      && feature.geometry.coordinates.every(isPosition)));
    if (data.perspective) {
      assert.equal(data.audience, "private", "3D camera modes are private-only");
      assert.equal(data.perspective.enabled, true);
      assert.ok(isPosition(data.perspective.center));
      assert.ok(data.perspective.zoom >= 0 && data.perspective.zoom <= 22);
      assert.ok(data.perspective.pitch >= 0 && data.perspective.pitch <= 60);
    }
    if (data.terrain) {
      assert.equal(data.audience, "private", "terrain modes are private-only");
      assert.equal(data.terrain.enabled, true);
      assert.equal(data.terrain.provider, "mapterhorn");
      assert.ok((data.terrain.exaggeration ?? 1) >= 0.1 && (data.terrain.exaggeration ?? 1) <= 5);
    }
    if (data.satellite) {
      assert.equal(data.audience, "private", "satellite modes are private-only");
      assert.equal(data.satellite.enabled, true);
      assert.equal(data.satellite.provider, "esri-world-imagery");
    }
  });
}

test("the public map does not contain private operating detail", async () => {
  const data = await readMap("dist/exampleland-2054/public/route-map.geojson");
  const serialized = JSON.stringify(data).toLowerCase();
  ["airport", "hotel", "booked", "geolocation", "address", "november", "december"].forEach((term) => {
    assert.equal(serialized.includes(term), false, `public route must not contain ${term}`);
  });
});
