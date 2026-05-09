export default function UnauthorizedPage() {
  return (
    <div className="px-8 py-8">
      <section className="rounded-lg border border-[#d8dee7] bg-white p-6">
        <h1 className="text-xl font-semibold text-[#16233a]">No Access</h1>
        <p className="mt-2 text-sm text-[#667085]">
          Your account does not currently have access to any portal area. Please
          contact an administrator to update your roles.
        </p>
      </section>
    </div>
  );
}
