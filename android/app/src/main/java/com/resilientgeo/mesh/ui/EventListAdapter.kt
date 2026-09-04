package com.resilientgeo.mesh.ui

import android.view.LayoutInflater
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.resilientgeo.mesh.R
import com.resilientgeo.mesh.data.EventEntity
import com.resilientgeo.mesh.ingest.ApplyState

class EventListAdapter : ListAdapter<EventEntity, EventListAdapter.ViewHolder>(DIFF) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_event, parent, false)
        return ViewHolder(view)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) = holder.bind(getItem(position))

    class ViewHolder(itemView: android.view.View) : RecyclerView.ViewHolder(itemView) {
        private val badge = itemView.findViewById<TextView>(R.id.badge)
        private val title = itemView.findViewById<TextView>(R.id.title)
        private val subtitle = itemView.findViewById<TextView>(R.id.subtitle)

        fun bind(entity: EventEntity) {
            title.text = "${entity.namespace} / ${entity.eventId}"
            subtitle.text = "${entity.eventType} v${entity.eventVersion} - expires ${entity.expiresAt}"
            val state = ApplyState.valueOf(entity.applyState)
            badge.text = state.name
            badge.setBackgroundColor(colorFor(state))
        }

        private fun colorFor(state: ApplyState): Int = when (state) {
            ApplyState.CURRENT -> 0xFF2E7D32.toInt()
            ApplyState.EXPIRED -> 0xFF616161.toInt()
            ApplyState.UNVERIFIED -> 0xFF6A1B9A.toInt()
        }
    }

    companion object {
        private val DIFF = object : DiffUtil.ItemCallback<EventEntity>() {
            override fun areItemsTheSame(oldItem: EventEntity, newItem: EventEntity) =
                oldItem.namespace == newItem.namespace && oldItem.eventId == newItem.eventId

            override fun areContentsTheSame(oldItem: EventEntity, newItem: EventEntity) = oldItem == newItem
        }
    }
}
