export default function HomePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-gray-900">
        Gestione Orario Scolastico
      </h1>
      <p className="text-gray-600">
        Punto di partenza dell&apos;app. Da qui si arriverà a gestire classi,
        docenti, le loro preferenze e l&apos;editor dell&apos;orario.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-gray-600">
        <li>Classi — anni e sezioni della scuola</li>
        <li>Docenti — anagrafica, materie, ore settimanali per classe</li>
        <li>Preferenze — vincoli espressi dai docenti</li>
        <li>Orario — editor a griglia, inserimento manuale e generazione automatica</li>
      </ul>
    </div>
  );
}
