import 'dart:typed_data';

Future<String> copyMapAssetToPrivateDirectory({
  required String fileName,
  required Uint8List bytes,
}) async {
  throw UnsupportedError(
    'Private map asset files are not available on this platform: $fileName',
  );
}
