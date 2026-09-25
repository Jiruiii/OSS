enum BridgeFailureCode {
  unavailable,
  invalidInput,
  signingUnavailable,
  storageUnavailable,
  graphUnavailable,
  routeEngineError,
  unknown,
}

final class BridgeFailure implements Exception {
  const BridgeFailure({required this.code, required this.message});

  final BridgeFailureCode code;
  final String message;

  @override
  String toString() => 'BridgeFailure($code): $message';
}
