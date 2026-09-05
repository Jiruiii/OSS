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
import java.time.Instant

class EventListAdapter : ListAdapter<EventEntity, EventListAdapter.ViewHolder>(DIFF) {

    /**
     * Re-render every visible badge against the current clock.
     *
     * The stored `applyState` never changes, so DiffUtil correctly reports
     * "nothing changed" as events expire — but the *displayed* state does
     * change, because it is derived from `expires_at` vs now (see
     * [ApplyState.at]). Without this the badge would stay CURRENT until
     * some unrelated write happened to rebind the row. Driven by a ticker
     * in MainActivity.
     */
    fun refreshExpiryStates() = notifyDataSetChanged()

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
            // Derived from the current clock, NOT entity.applyState: that
            // column records the state at ingest time and goes stale as
            // soon as expires_at passes, which offline is the normal case.
            val state = ApplyState.at(entity.namespace, entity.expiresAt, Instant.now())
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
