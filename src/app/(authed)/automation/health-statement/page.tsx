import HealthStatementClient from "./HealthStatementClient";

export default function HealthStatementPage() {
  return (
    <div className="px-8 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[#16233a]">
          Health Statement
        </h1>
        <p className="mt-1 text-sm text-[#667085]">
          Upload carrier payment data and prepare the monthly statement report.
        </p>
      </header>
      <HealthStatementClient />
    </div>
  );
}
