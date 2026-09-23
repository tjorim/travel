// @vitest-environment jsdom
import { expect, it } from "vitest";
import { parseRecordedTrack } from "./track-geometry";

it("parses owner JSON point arrays without changing coordinate order", () => {
  const data = JSON.stringify({ points: [{ latitude: 25, longitude: 121, time: "2054-01-01T00:00:00Z" }, { lat: 26, lon: 122, time: "2054-01-01T00:01:00Z" }] });
  expect(parseRecordedTrack(data, "point_array")).toEqual([[[121, 25], [122, 26]]]);
});

it("keeps GPX track segments separate and rejects missing coordinates", () => {
  const data = `<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="25" lon="121"/><trkpt lat="26" lon="122"/></trkseg><trkseg><trkpt lat="27" lon="123"/><trkpt lat="28" lon="124"/></trkseg></trk></gpx>`;
  expect(parseRecordedTrack(data, "gpx")).toEqual([[[121, 25], [122, 26]], [[123, 27], [124, 28]]]);
  expect(() => parseRecordedTrack('[{"latitude":null,"longitude":121},{"latitude":26,"longitude":122}]', "point_array")).toThrow();
});
