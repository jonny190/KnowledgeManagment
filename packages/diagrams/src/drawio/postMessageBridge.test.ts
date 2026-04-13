import { describe, it, expect } from 'vitest';
import { parseDrawioEvent, buildLoadAction, buildStatusAction } from './postMessageBridge';

describe('parseDrawioEvent', () => {
  it('parses an init event', () => {
    expect(parseDrawioEvent('{"event":"init"}')).toEqual({ event: 'init' });
  });

  it('parses a save event with xml', () => {
    expect(parseDrawioEvent('{"event":"save","xml":"<x/>"}')).toEqual({
      event: 'save',
      xml: '<x/>',
    });
  });

  it('returns null for an unknown event', () => {
    expect(parseDrawioEvent('{"event":"other"}')).toBeNull();
  });

  it('returns null for non-JSON data', () => {
    expect(parseDrawioEvent('not-json')).toBeNull();
  });
});

describe('buildLoadAction', () => {
  it('returns a JSON string with load action and xml', () => {
    const msg = buildLoadAction('<mxfile/>');
    expect(JSON.parse(msg)).toEqual({ action: 'load', xml: '<mxfile/>', autosave: 1 });
  });
});

describe('buildStatusAction', () => {
  it('returns a JSON string with status action', () => {
    expect(JSON.parse(buildStatusAction(false))).toEqual({
      action: 'status',
      modified: false,
    });
  });
});
