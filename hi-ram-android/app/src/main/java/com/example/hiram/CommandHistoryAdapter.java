package com.example.hiram;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.RecyclerView;

import java.util.List;

public class CommandHistoryAdapter extends RecyclerView.Adapter<CommandHistoryAdapter.ViewHolder> {

    private final List<CommandHistoryItem> items;

    public CommandHistoryAdapter(List<CommandHistoryItem> items) {
        this.items = items;
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext())
                .inflate(R.layout.item_command_history, parent, false);
        return new ViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        CommandHistoryItem item = items.get(position);
        holder.txtCommand.setText(item.commandText);
        holder.txtFeedback.setText(item.resultFeedback);
        holder.txtTime.setText(item.timestamp);

        if (item.success) {
            holder.txtStatusIcon.setText("✓");
            holder.txtStatusIcon.setTextColor(ContextCompat.getColor(holder.itemView.getContext(), R.color.hiram_green));
        } else {
            holder.txtStatusIcon.setText("✕");
            holder.txtStatusIcon.setTextColor(ContextCompat.getColor(holder.itemView.getContext(), R.color.hiram_red));
        }
    }

    @Override
    public int getItemCount() {
        return items.size();
    }

    static class ViewHolder extends RecyclerView.ViewHolder {
        final TextView txtStatusIcon;
        final TextView txtCommand;
        final TextView txtFeedback;
        final TextView txtTime;

        ViewHolder(View itemView) {
            super(itemView);
            txtStatusIcon = itemView.findViewById(R.id.txtHistoryStatusIcon);
            txtCommand = itemView.findViewById(R.id.txtHistoryCommand);
            txtFeedback = itemView.findViewById(R.id.txtHistoryFeedback);
            txtTime = itemView.findViewById(R.id.txtHistoryTime);
        }
    }
}
