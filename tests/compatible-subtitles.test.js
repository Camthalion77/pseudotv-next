'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const FFMPEG = require('../src/ffmpeg')
const engine = new FFMPEG({ffmpegPath:'ffmpeg'}, {number:1,name:'Test'})
const media = streams => ({streams})
test('choose only embedded DVB subtitles; Greek first', () => {
  assert.deepEqual(engine.selectCompatibleSubtitle(media([
    {streamType:3,codec:'ass',index:2,language:'ell'},
    {streamType:3,codec:'dvb_subtitle',index:5,language:'eng'},
    {streamType:3,codec:'dvbsub',index:6,language:'ell'}
  ]), '-2'), {map:'0:6',language:'ell'})
})
test('skip unsupported and external subtitle codecs', () => {
  assert.equal(engine.selectCompatibleSubtitle(media([
    {streamType:3,codec:'ass',index:2},
    {streamType:3,codec:'srt',index:3},
    {streamType:3,codec:'hdmv_pgs_subtitle',index:4},
    {streamType:3,codec:'dvbsub',index:5,external:true}
  ]), '-2'),null)
})
test('explicit unsupported track is skipped, not replaced', () => {
  assert.equal(engine.selectCompatibleSubtitle(media([
    {streamType:3,codec:'ass',index:2},
    {streamType:3,codec:'dvbsub',index:3}
  ]), '2'),null)
})
test('explicit compatible track and user off preference', () => {
  const item=media([{streamType:3,codec:'dvbsub',index:9,language:'eng'}])
  assert.deepEqual(engine.selectCompatibleSubtitle(item,'9'),{map:'0:9',language:'eng'})
  assert.equal(engine.selectCompatibleSubtitle(item,'-3'),null)
})
test('missing index is never guessed', () => {
  assert.equal(engine.selectCompatibleSubtitle(media([{streamType:3,codec:'dvbsub',language:'ell'}]),'-2'),null)
})
