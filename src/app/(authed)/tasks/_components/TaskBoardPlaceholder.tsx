type Props = {
  isManager: boolean;
};

export function TaskBoardPlaceholder({ isManager }: Props) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-[#0f2849]">Tasks</h1>
      <p className="mt-2 text-sm text-slate-500">
        Task board is coming online.
        {isManager
          ? " You can manage and assign tasks."
          : " You can work on tasks assigned to you."}
      </p>
    </div>
  );
}
