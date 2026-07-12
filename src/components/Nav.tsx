import Link from "next/link";

const links = [
  { href: "/", label: "Home" },
  { href: "/classi", label: "Classi" },
  { href: "/docenti", label: "Docenti" },
  { href: "/preferenze", label: "Preferenze" },
  { href: "/orario", label: "Orario" },
];

export default function Nav() {
  return (
    <nav className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
        <span className="font-semibold text-gray-900">Orario Scolastico</span>
        <ul className="flex gap-4 text-sm text-gray-600">
          {links.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="hover:text-gray-900">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
