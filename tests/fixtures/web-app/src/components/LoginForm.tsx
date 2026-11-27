import { login } from '@/auth';
import { formatDate } from '~utils/format';
import './LoginForm.css';

export function LoginForm() {
  return <form className="login" onSubmit={() => login({ id: '1', name: 'x' })}>{formatDate(new Date())}</form>;
}
