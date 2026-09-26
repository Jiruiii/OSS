#!/usr/bin/env python3
"""Measure the local Flutter profile app over USB without changing user data.

Requires the profile build's VM service extensions. Exercises read-only route
and search requests and, optionally, map swipes. Writes explicit raw observations
instead of claiming an FPS based on Android's unrelated host window metrics.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import time
from urllib.parse import urlencode
from urllib.request import urlopen


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--adb', required=True)
    parser.add_argument('--serial', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--swipes', action='store_true')
    args = parser.parse_args()
    def adb(*command):
        return subprocess.check_output([args.adb,'-s',args.serial,*command],text=True,encoding='utf-8',errors='replace')
    pid = adb('shell','pidof','com.resilientgeo.mesh').strip()
    logs = adb('logcat','-d','--pid',pid,'-s','flutter:I')
    services = re.findall(r'The Dart VM service is listening on http://127\.0\.0\.1:(\d+)/([^\s]+)',logs)
    if not services:
        raise RuntimeError('No VM service for the running app; install/start a profile build first')
    device_port, token = services[-1]
    host_port = adb('forward','tcp:0',f'tcp:{device_port}').strip()
    base = f'http://127.0.0.1:{host_port}/{token.rstrip("/")}/'
    def rpc(method, **params):
        with urlopen(base+method+'?'+urlencode(params),timeout=30) as response:
            payload = json.load(response)
        if 'error' in payload:
            raise RuntimeError(payload['error'])
        return payload['result']
    try:
        isolates = rpc('getVM')['isolates']
        isolate = next(i['id'] for i in isolates if i['name']=='main')
        def call(method, **params):
            return rpc('ext.resilientgeo.'+method,isolateId=isolate,**params)
        observations = {'captured_at':datetime.now(timezone.utc).isoformat(),'device_serial':args.serial}
        # Wait in short intervals for the already-backgrounded search asset.
        for _ in range(60):
            if call('search',query='成功路').get('ready'):
                break
            time.sleep(.5)
        else:
            raise RuntimeError('Search worker did not become ready')
        observations['search'] = []
        for query in ['成功路','板橋','中正路','新北市板橋區文化路一段']:
            for _ in range(3):
                observations['search'].append({'query':query,**call('search',query=query)})
        pairs = [
            ('taipei',121.517,25.047,121.525,25.048),
            ('banqiao',121.462,25.014,121.459,25.009),
            ('sanchong',121.486,25.055,121.491,25.057),
            ('xindian',121.537,24.967,121.533,24.973),
            ('tamsui',121.445,25.168,121.441,25.171),
            ('cross_city_bridge',121.506,25.062,121.492,25.063),
        ]
        observations['routes'] = []
        for name,lon,lat,target_lon,target_lat in pairs:
            for iteration in range(6):
                result = call('routeBenchmark',lon=lon,lat=lat,targetLon=target_lon,targetLat=target_lat)
                observations['routes'].append({'case':name,'iteration':iteration,**result})
        if args.swipes:
            call('performance',reset='true')
            for i in range(12):
                start,end = (750,350) if i%2==0 else (350,750)
                adb('shell','input','swipe',str(start),'1100',str(end),'1100','600')
                time.sleep(.15)
            time.sleep(.8)
            observations['pan_frames'] = call('performance')
        observations['dart_memory'] = rpc('getMemoryUsage',isolateId=isolate)
        observations['android_memory'] = adb('shell','dumpsys','meminfo','com.resilientgeo.mesh')
        observations['thermal_status'] = '\n'.join(line for line in adb('shell','dumpsys','thermalservice').splitlines() if 'Thermal Status' in line)
        def p95(values):
            values = sorted(values)
            return values[round((len(values)-1)*.95)]
        observations['summary'] = {
            'cold_route_ms':observations['routes'][0]['elapsed_ms'],
            'warm_route_p95_ms':p95([r['elapsed_ms'] for r in observations['routes'] if r['iteration']>0]),
            'search_p95_ms':p95([s['elapsed_ms'] for s in observations['search']]),
            'all_routes_ok':all(r['status']=='ok' for r in observations['routes']),
        }
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(observations,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        print(json.dumps({'summary':observations['summary'],'pan_frames':observations.get('pan_frames'),'thermal_status':observations['thermal_status'],'output':str(args.output)},ensure_ascii=True))
    finally:
        adb('forward','--remove',f'tcp:{host_port}')


if __name__=='__main__':
    main()
