import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container-page py-20 text-center">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <Link href="/" className="mt-4 inline-block text-brand-700">
        Go home →
      </Link>
    </div>
  );
}
