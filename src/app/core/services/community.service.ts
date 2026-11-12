import { Injectable, inject } from '@angular/core';
import type { CommentThread, ReportComment, ReportVolunteer } from '../models/community.model';
import { AuthService } from './auth.service';

/** Interacción en un reporte: "Me afecta" (RF-24), comentarios (RF-25) y voluntarios (RF-26). */
@Injectable({ providedIn: 'root' })
export class CommunityService {
  private readonly auth = inject(AuthService);

  /** Marca o quita "Me afecta". Devuelve true si quedó apoyado. */
  async toggleSupport(reportId: string): Promise<boolean> {
    const client = await this.auth.supabase();
    const { data, error } = await client.rpc('toggle_report_support', { target_report: reportId });
    if (error) throw error;
    return data as boolean;
  }

  /** Se suma o se retira como voluntario. Devuelve true si quedó sumado. */
  async toggleVolunteer(reportId: string): Promise<boolean> {
    const client = await this.auth.supabase();
    const { data, error } = await client.rpc('toggle_report_volunteer', { target_report: reportId });
    if (error) throw error;
    return data as boolean;
  }

  async listVolunteers(reportId: string): Promise<ReportVolunteer[]> {
    const client = await this.auth.supabase();
    const { data, error } = await client
      .from('public_report_volunteers')
      .select('*')
      .eq('report_id', reportId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as ReportVolunteer[];
  }

  /** Comentarios agrupados en hilos (más antiguos primero, como una conversación). */
  async listComments(reportId: string): Promise<CommentThread[]> {
    const client = await this.auth.supabase();
    const { data, error } = await client
      .from('public_report_comments')
      .select('*')
      .eq('report_id', reportId)
      .order('created_at', { ascending: true })
      .limit(500);
    if (error) throw error;
    return buildThreads((data ?? []) as ReportComment[]);
  }

  async addComment(reportId: string, body: string, replyTo: string | null = null): Promise<string> {
    const client = await this.auth.supabase();
    const { data, error } = await client.rpc('add_report_comment', { target_report: reportId, comment_body: body.trim(), reply_to: replyTo });
    if (error) throw error;
    return data as string;
  }

  async editComment(commentId: string, body: string): Promise<void> {
    const client = await this.auth.supabase();
    const { error } = await client.rpc('edit_report_comment', { target_comment: commentId, comment_body: body.trim() });
    if (error) throw error;
  }

  async deleteComment(commentId: string): Promise<void> {
    const client = await this.auth.supabase();
    const { error } = await client.rpc('delete_report_comment', { target_comment: commentId });
    if (error) throw error;
  }
}

/**
 * Arma los hilos: cada comentario principal con sus respuestas.
 * Un comentario eliminado sin respuestas desaparece; con respuestas queda como "Comentario eliminado".
 */
export function buildThreads(comments: ReportComment[]): CommentThread[] {
  const threads = new Map<string, CommentThread>();
  for (const comment of comments) {
    if (!comment.parent_id) threads.set(comment.id, { ...comment, replies: [] });
  }
  for (const comment of comments) {
    if (comment.parent_id && !comment.is_deleted) threads.get(comment.parent_id)?.replies.push(comment);
  }
  return [...threads.values()].filter((thread) => !thread.is_deleted || thread.replies.length > 0);
}
