"""Integration-test actual XMLTV generation, its structural order and programme references."""
from xml.etree import ElementTree as ET
import subprocess

js = r'''
const {generateSchedule,xmltv}=require('./src/epg');
const ch=[{number:101,name:'Ελληνικό & κανάλι',startTime:'2020-01-01T00:00:00Z',duration:3600000,programs:[
{title:'Ταινία <δοκιμή>',summary:'Κείμενο & ελληνικά',type:'movie',year:1986,genres:['Δράμα'],directors:['Δημιουργός'],actors:['Ηθοποιός'],duration:3600000,actualDuration:3600000,rating:'PG',starRating:8.5}
]}];
const t=Date.parse('2026-11-08T12:00:00Z');
process.stdout.write(xmltv(ch,generateSchedule(ch,t,336),'http://zima.lan:8098'));
'''
r = subprocess.run(['node','-e',js], capture_output=True, check=True, text=True)
root = ET.fromstring(r.stdout)
assert root.tag == 'tv'
channels = {c.attrib['id'] for c in root.findall('channel')}
assert channels == {'101'}
programmes = root.findall('programme')
assert len(programmes) >= 330
order = 'title sub-title desc credits date category keyword language orig-language length icon url country episode-num video audio previously-shown premiere last-chance new subtitles rating star-rating review image'.split()
rank = {name:i for i,name in enumerate(order)}
previous = {}
for p in programmes:
    assert p.attrib['channel'] in channels
    assert p.attrib['start'] < p.attrib['stop']
    assert p.find('title') is not None
    sequence = [rank[c.tag] for c in p if c.tag in rank]
    assert sequence == sorted(sequence), sequence
    start = p.attrib['start']
    stop = p.attrib['stop']
    if p.attrib['channel'] in previous:
        assert previous[p.attrib['channel']] == start
    previous[p.attrib['channel']] = stop
assert 'X-Plex-Token' not in r.stdout
assert '&lt;δοκιμή&gt;' in r.stdout
assert '&amp;' in r.stdout
print('XMLTV: well-formed, 14-day coverage, ordered elements, correct times/IDs, Greek text and no exposed token')
