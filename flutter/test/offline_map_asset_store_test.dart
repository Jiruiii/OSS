import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:resilientgeo_flutter/data/offline_map_asset_store.dart';

void main() {
  test('rewrites PMTiles asset URIs to installed local files', () {
    const style = '{"url":"pmtiles://asset://assets/map/pmtiles/taiwan.pmtiles",'
        '"glyphs":"asset://assets/map/fonts/{fontstack}/{range}.pbf"}';

    final rewritten = OfflineMapAssetStore.rewriteStyleAssetUris(
      style,
      assetFiles: <String, String>{
        'assets/map/pmtiles/taiwan.pmtiles':
            '/data/user/0/com.example/files/maps/taiwan.pmtiles',
        'assets/map/fonts/{fontstack}/{range}.pbf':
            '/data/user/0/com.example/files/maps/fonts/{fontstack}/{range}.pbf',
      },
    );

    expect(
      rewritten,
      '{"url":"pmtiles://file:///data/user/0/com.example/files/maps/taiwan.pmtiles",'
      '"glyphs":"file:///data/user/0/com.example/files/maps/fonts/{fontstack}/{range}.pbf"}',
    );
  });

  test('rewrites PMTiles and style assets to web package URLs', () {
    const style = '{"url":"pmtiles://asset://assets/map/pmtiles/taiwan.pmtiles",'
        '"glyphs":"asset://assets/map/fonts/{fontstack}/{range}.pbf",'
        '"sprite":"asset://assets/map/sprites/v4/light"}';

    final assetsBase = Uri.base.resolve('assets/');
    final glyphsUri =
        '${assetsBase.resolve('map/fonts/')}'
        '{fontstack}/{range}.pbf';
    expect(
      OfflineMapAssetStore.rewriteWebStyleAssetUris(style),
      '{"url":"pmtiles://${assetsBase.resolve('map/pmtiles/taiwan.pmtiles')}",'
      '"glyphs":"$glyphsUri",'
      '"sprite":"${assetsBase.resolve('map/sprites/v4/light')}"}',
    );
  });

  test('rewrites web styles to absolute assets and direct PMTiles tiles', () {
    const style = '{'
        '"sprite":"asset://assets/map/sprites/v4/light",'
        '"glyphs":"asset://assets/map/fonts/{fontstack}/{range}.pbf",'
        '"sources":{'
        '"taiwan":{"type":"vector",'
        '"url":"pmtiles://asset://assets/map/pmtiles/taiwan.pmtiles",'
        '"minzoom":0,"maxzoom":12}'
        '}'
        '}';

    final document = jsonDecode(
          OfflineMapAssetStore.rewriteWebStyleAssetUris(style),
        )
        as Map<String, dynamic>;
    final assetsBase = Uri.base.resolve('assets/');
    final source = (document['sources'] as Map<String, dynamic>)['taiwan']
        as Map<String, dynamic>;
    final archiveUri = assetsBase.resolve('map/pmtiles/taiwan.pmtiles');
    final glyphsUri =
        '${assetsBase.resolve('map/fonts/')}'
        '{fontstack}/{range}.pbf';

    expect(
      document['sprite'],
      assetsBase.resolve('map/sprites/v4/light').toString(),
    );
    expect(
      document['glyphs'],
      glyphsUri,
    );
    expect(
      source['tiles'],
      <String>['pmtiles://$archiveUri/{z}/{x}/{y}'],
    );
    expect(source.containsKey('url'), isFalse);
  });
}
