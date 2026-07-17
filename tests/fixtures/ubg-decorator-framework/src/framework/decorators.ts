// A bespoke framework — none of these names are @nestjs or @Controller. SPARDA must
// recognize the ROUTES by the HTTP verb and the guarded-by-default posture by the
// skipAuth opt-out, with zero knowledge of this framework.
export function RestController(path: string): ClassDecorator {
  return () => {};
}
export function Get(path: string, opts?: object): MethodDecorator {
  return () => {};
}
export function Post(path: string, opts?: object): MethodDecorator {
  return () => {};
}
