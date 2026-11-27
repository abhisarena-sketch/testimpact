import { Badge } from '@/components/ui/badge';

export function ConfidenceBadge({ confidence }: { confidence: 'high' | 'medium' | 'low' }) {
  return <Badge variant={confidence}>{confidence}</Badge>;
}
