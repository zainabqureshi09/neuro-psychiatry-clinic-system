import { createClient } from '@/utils/supabase/server';
import { cookies } from 'next/headers';

export default async function SupabaseTestPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: todos, error } = await supabase.from('todos').select();

  return (
    <div className="p-8 max-w-xl mx-auto font-sans bg-white rounded-xl shadow-xs mt-8 border border-slate-200">
      <h1 className="text-xl font-bold text-slate-900 mb-4">Supabase Connection Test</h1>
      {error && (
        <div className="p-4 mb-4 bg-amber-50 text-amber-800 rounded-lg text-sm border border-amber-200">
          <strong>Notice:</strong> {error.message}
        </div>
      )}
      <ul className="space-y-2">
        {todos && todos.length > 0 ? (
          todos.map((todo: any) => (
            <li key={todo.id} className="p-2 bg-slate-50 rounded border text-slate-800">
              {todo.name || todo.title || JSON.stringify(todo)}
            </li>
          ))
        ) : (
          <li className="text-slate-500 text-sm">
            No rows found in 'todos' table yet. Connection configured successfully.
          </li>
        )}
      </ul>
    </div>
  );
}
