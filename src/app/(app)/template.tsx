/** Recria a cada troca de página: no visual novo, a tela entra com um leve desfoque e subida. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="nx-page">{children}</div>;
}
