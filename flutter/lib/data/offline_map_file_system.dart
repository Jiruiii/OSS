import 'dart:typed_data';

import 'offline_map_file_system_stub.dart'
    if (dart.library.io) 'offline_map_file_system_io.dart' as implementation;

Future<String> copyMapAssetToPrivateDirectory({
  required String fileName,
  required Uint8List bytes,
}) => implementation.copyMapAssetToPrivateDirectory(
  fileName: fileName,
  bytes: bytes,
);
