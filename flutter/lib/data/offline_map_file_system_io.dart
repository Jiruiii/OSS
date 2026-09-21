import 'dart:io';
import 'dart:typed_data';

import 'package:path_provider/path_provider.dart';

Future<String> copyMapAssetToPrivateDirectory({
  required String fileName,
  required Uint8List bytes,
}) async {
  final supportDirectory = await getApplicationSupportDirectory();
  final mapsDirectory = Directory('${supportDirectory.path}/maps');
  await mapsDirectory.create(recursive: true);
  final file = File('${mapsDirectory.path}/$fileName');
  await file.writeAsBytes(bytes, flush: true);
  return file.path;
}
