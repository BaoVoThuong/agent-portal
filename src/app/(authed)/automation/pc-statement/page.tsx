import PcStatementClient from "./PcStatementClient";

export default function PcStatementPage() {
  return (
    <div className="px-8 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[#16233a]">
          P&amp;C Statement
        </h1>
        <p className="mt-1 text-sm text-[#667085]">
          Upload payment files and prepare the P&amp;C statement report.
        </p>
      </header>
      <PcStatementClient />
    </div>
  );
}
