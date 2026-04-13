declare module 'bpmn-moddle' {
  interface FromXMLResult {
    rootElement: { $type: string };
    warnings: unknown[];
  }

  export default class BpmnModdle {
    fromXML(xml: string): Promise<FromXMLResult>;
  }
}
