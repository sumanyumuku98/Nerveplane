// Ambient declarations for Bun asset imports (`with { type: "text" }`), used to
// embed migrations and the built dashboard into the compiled single binary.
declare module "*.sql" {
  const content: string;
  export default content;
}
declare module "*.html" {
  const content: string;
  export default content;
}
