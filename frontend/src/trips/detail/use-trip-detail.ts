import {
  useLinkedLibraryDocuments,
  useTripResource,
  useTripsQuery,
} from "../../query/owner-queries";

/** Every read behind the owner's complete trip overview; nothing is read for a trip that does not exist. */
export function useTripDetail(tripId: string | undefined) {
  const tripsQuery = useTripsQuery();
  const trip = tripId
    ? (tripsQuery.data?.find((candidate) => candidate.id === tripId) ?? null)
    : null;
  const id = trip ? trip.id : null;
  const placesQuery = useTripResource(id, "locations");
  const areasQuery = useTripResource(id, "areas");
  const routesQuery = useTripResource(id, "routes");
  const staysQuery = useTripResource(id, "stays");
  const visitsQuery = useTripResource(id, "visits");
  const tasksQuery = useTripResource(id, "trip-tasks");
  const documentsQuery = useTripResource(id, "documents");
  const libraryDocumentsQuery = useLinkedLibraryDocuments(id);
  const mediaQuery = useTripResource(id, "media");

  const readError = [
    tripsQuery,
    placesQuery,
    areasQuery,
    routesQuery,
    staysQuery,
    visitsQuery,
    tasksQuery,
    documentsQuery,
    libraryDocumentsQuery,
    mediaQuery,
  ].find((query) => query.isError)?.error;

  return {
    tripsLoaded: tripsQuery.isSuccess,
    trip,
    places: placesQuery.data,
    areas: areasQuery.data,
    routes: routesQuery.data,
    stays: staysQuery.data,
    visits: visitsQuery.data,
    tasks: tasksQuery.data,
    documents: documentsQuery.data,
    libraryDocuments: libraryDocumentsQuery.data,
    media: mediaQuery.data,
    readError,
  };
}
