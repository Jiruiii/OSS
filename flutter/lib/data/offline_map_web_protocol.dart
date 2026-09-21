import 'offline_map_web_protocol_stub.dart'
    if (dart.library.html) 'offline_map_web_protocol_web.dart';

Future<void> registerOfflineMapProtocol() => registerWebPmtilesProtocol();
