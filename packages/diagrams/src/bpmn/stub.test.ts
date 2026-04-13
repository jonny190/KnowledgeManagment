import { describe, it, expect } from 'vitest';
import BpmnModdle from 'bpmn-moddle';
import { blankBpmn } from './blankBpmn';

describe('blankBpmn', () => {
  it('is parseable by bpmn-moddle', async () => {
    const moddle = new BpmnModdle();
    const { rootElement, warnings } = await moddle.fromXML(blankBpmn());
    expect(warnings).toEqual([]);
    expect(rootElement.$type).toBe('bpmn:Definitions');
  });
});
