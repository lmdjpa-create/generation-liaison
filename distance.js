function getServiceDistance(latitude, longitude, destinationLatitude, destinationLongitude, serviceRadiusKm) {
  const coordinates = [latitude, longitude, destinationLatitude, destinationLongitude];
  if (!coordinates.every(Number.isFinite)) {
    return { distanceKm: null, outsideServiceRadius: null };
  }

  const toRadians = degrees => degrees * Math.PI / 180;
  const latitudeDifference = toRadians(destinationLatitude - latitude);
  const longitudeDifference = toRadians(destinationLongitude - longitude);
  const haversine = Math.min(1, Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(toRadians(latitude)) * Math.cos(toRadians(destinationLatitude)) *
    Math.sin(longitudeDifference / 2) ** 2);
  const exactDistanceKm = 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  return {
    distanceKm: Math.round(exactDistanceKm),
    outsideServiceRadius: Number.isInteger(serviceRadiusKm) && exactDistanceKm > serviceRadiusKm
  };
}

module.exports = { getServiceDistance };
